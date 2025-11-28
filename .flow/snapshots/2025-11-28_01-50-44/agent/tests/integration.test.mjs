import { test } from 'node:test'
import assert from 'node:assert'
import { ConfigLoader } from '../core/config-loader.mjs'
import { MCPClient } from '../core/mcp-client.mjs'
import { FileOpsServer } from '../mcp-servers/file-ops-server.mjs'
import { TestRunnerServer } from '../mcp-servers/test-runner-server.mjs'
import { AnalysisServer } from '../mcp-servers/analysis-server.mjs'
import { InternetServer } from '../mcp-servers/internet-server.mjs'
import { ProviderFactory } from '../ai-providers/provider-factory.mjs'
import path from 'path'
import fs from 'fs/promises'

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

test('MCP Servers - File Operations Server starts and stops', async (t) => {
	const testDir = path.join(process.cwd(), 'project')
	await fs.mkdir(testDir, { recursive: true })

	const server = new FileOpsServer(3200, testDir)
	await server.start()

	// Test health endpoint
	const response = await fetch('http://localhost:3200/health')
	assert.strictEqual(response.ok, true, 'Health check should succeed')

	const data = await response.json()
	assert.strictEqual(data.status, 'ok', 'Server should be healthy')

	await server.stop()
})

test('MCP Servers - Test Runner Server starts and stops', async (t) => {
	const testDir = path.join(process.cwd(), 'project')
	await fs.mkdir(testDir, { recursive: true })

	const server = new TestRunnerServer(3201, testDir)
	await server.start()

	const response = await fetch('http://localhost:3201/health')
	assert.strictEqual(response.ok, true, 'Health check should succeed')

	await server.stop()
})

test('MCP Servers - Analysis Server starts and stops', async (t) => {
	const testDir = path.join(process.cwd(), 'project')
	await fs.mkdir(testDir, { recursive: true })

	const server = new AnalysisServer(3202, testDir)
	await server.start()

	const response = await fetch('http://localhost:3202/health')
	assert.strictEqual(response.ok, true, 'Health check should succeed')

	await server.stop()
})

test('MCP Servers - Internet Server starts and stops', async (t) => {
	const server = new InternetServer(3203)
	await server.start()

	const response = await fetch('http://localhost:3203/health')
	assert.strictEqual(response.ok, true, 'Health check should succeed')

	await server.stop()
})

test('MCP Client - lists tools from servers', async (t) => {
	const testDir = path.join(process.cwd(), 'project')
	await fs.mkdir(testDir, { recursive: true })

	// Start servers
	const servers = []
	servers.push(new FileOpsServer(3210, testDir))
	servers.push(new TestRunnerServer(3211, testDir))
	servers.push(new AnalysisServer(3212, testDir))
	servers.push(new InternetServer(3213))

	for (const server of servers) {
		await server.start()
	}

	// Wait for servers to be ready
	await new Promise((resolve) => setTimeout(resolve, 100))

	// Test MCP client
	const client = new MCPClient({
		file_ops: 3210,
		run_tests: 3211,
		analysis: 3212,
		internet: 3213,
	})

	const tools = await client.listTools()
	assert.ok(tools.length > 0, 'Should have tools')

	// Check for expected tools
	const toolNames = tools.map((t) => t.name)
	assert.ok(toolNames.includes('read_file'), 'Should have read_file tool')
	assert.ok(toolNames.includes('write_file'), 'Should have write_file tool')
	assert.ok(toolNames.includes('run_node_tests'), 'Should have run_node_tests tool')

	// Stop servers
	for (const server of servers) {
		await server.stop()
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

