#!/usr/bin/env node

/**
 * MCP Client for Docker Container
 * Connects to host MCP servers and forwards tool calls
 * 
 * This runs inside the Docker container and communicates with
 * MCP servers running on the host via HTTP
 */

const MCP_SERVERS = {
	file_ops: process.env.MCP_FILE_OPS_PORT || 3100,
	run_tests: process.env.MCP_TEST_RUNNER_PORT || 3101,
	analysis: process.env.MCP_ANALYSIS_PORT || 3102,
	internet: process.env.MCP_INTERNET_PORT || 3103,
}

const HOST = process.env.MCP_HOST || 'host.docker.internal'

/**
 * List all available tools from all servers
 */
async function listTools() {
	const allTools = []

	for (const [category, port] of Object.entries(MCP_SERVERS)) {
		try {
			const response = await fetch(`http://${HOST}:${port}/tools/list`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
			})

			if (!response.ok) {
				console.error(`Failed to list tools from ${category}: ${response.statusText}`)
				continue
			}

			const data = await response.json()
			const tools = data.tools || []

			for (const tool of tools) {
				tool._category = category
				tool._port = port
				allTools.push(tool)
			}
		} catch (error) {
			console.error(`Error listing tools from ${category}:`, error.message)
		}
	}

	return allTools
}

/**
 * Call a tool on the appropriate server
 */
async function callTool(toolName, args) {
	const tools = await listTools()
	const tool = tools.find((t) => t.name === toolName)

	if (!tool) {
		throw new Error(`Tool '${toolName}' not found`)
	}

	const port = tool._port

	const response = await fetch(`http://${HOST}:${port}/tools/call`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			name: toolName,
			arguments: args,
		}),
	})

	if (!response.ok) {
		const error = await response.json()
		throw new Error(`Tool execution failed: ${error.error}`)
	}

	return await response.json()
}

// Main execution
if (import.meta.url === `file://${process.argv[1]}`) {
	console.log('[Docker MCP Client] Starting...')
	console.log('[Docker MCP Client] Connecting to host MCP servers...')

	// Test connection
	listTools()
		.then((tools) => {
			console.log(`[Docker MCP Client] Connected. Found ${tools.length} tools.`)
			console.log('[Docker MCP Client] Ready to receive commands.')
			
			// Keep the process alive indefinitely
			// The container will be stopped explicitly by the orchestrator
			setInterval(() => {
				// Heartbeat every 30 seconds to keep container alive
			}, 30000)
		})
		.catch((error) => {
			console.error('[Docker MCP Client] Failed to connect:', error.message)
			process.exit(1)
		})

	// Graceful shutdown
	process.on('SIGTERM', () => {
		console.log('[Docker MCP Client] Received SIGTERM, shutting down...')
		process.exit(0)
	})
	
	process.on('SIGINT', () => {
		console.log('[Docker MCP Client] Received SIGINT, shutting down...')
		process.exit(0)
	})
}

export { listTools, callTool }

