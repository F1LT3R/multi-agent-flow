/**
 * MCP Client for communicating with MCP servers
 * Sends HTTP requests to MCP servers running on host
 */
export class MCPClient {
	constructor(serverPorts = {}) {
		this.serverPorts = {
			file_ops: serverPorts.file_ops || 3100,
			run_tests: serverPorts.run_tests || 3101,
			analysis: serverPorts.analysis || 3102,
			internet: serverPorts.internet || 3103,
		}
		this.baseUrl = 'http://localhost'
	}

	/**
	 * List available tools from all servers
	 */
	async listTools() {
		const allTools = []

		for (const [category, port] of Object.entries(this.serverPorts)) {
			try {
				const response = await fetch(`${this.baseUrl}:${port}/tools/list`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
				})

				if (!response.ok) {
					console.error(`Failed to list tools from ${category}: ${response.statusText}`)
					continue
				}

				const data = await response.json()
				const tools = data.tools || []

				// Add category metadata
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
	 * Call a tool on the appropriate MCP server
	 */
	async callTool(toolName, args) {
		// Find which server has this tool
		const tools = await this.listTools()
		const tool = tools.find((t) => t.name === toolName)

		if (!tool) {
			throw new Error(`Tool '${toolName}' not found on any MCP server`)
		}

		const port = tool._port

		try {
			const response = await fetch(`${this.baseUrl}:${port}/tools/call`, {
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

			const result = await response.json()
			return result
		} catch (error) {
			throw new Error(`Failed to call tool '${toolName}': ${error.message}`)
		}
	}

	/**
	 * Filter tools based on agent's mcp_tools configuration
	 */
	filterTools(allTools, mcpToolsConfig) {
		if (!mcpToolsConfig) {
			return allTools
		}

		const { include, exclude } = mcpToolsConfig

		let filtered = [...allTools]

		// Apply include filter (by category)
		if (include && include.length > 0) {
			filtered = filtered.filter((tool) => include.includes(tool._category))
		}

		// Apply exclude filter (by tool name)
		if (exclude && exclude.length > 0) {
			filtered = filtered.filter((tool) => !exclude.includes(tool.name))
		}

		return filtered
	}
}

