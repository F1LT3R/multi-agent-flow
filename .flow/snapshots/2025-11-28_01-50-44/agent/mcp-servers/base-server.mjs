import express from 'express'
import cors from 'cors'

/**
 * Base MCP Server implementation using HTTP/JSON-RPC
 * Provides foundation for tool-based MCP servers
 */
export class BaseMCPServer {
	constructor(name, port) {
		this.name = name
		this.port = port
		this.tools = new Map()
		this.app = express()
		
		this.app.use(cors())
		this.app.use(express.json())
		
		this._setupRoutes()
	}

	/**
	 * Register a tool with the server
	 */
	registerTool(name, description, inputSchema, handler) {
		this.tools.set(name, {
			name,
			description,
			inputSchema,
			handler,
		})
	}

	/**
	 * Setup HTTP routes for MCP protocol
	 */
	_setupRoutes() {
		// Health check
		this.app.get('/health', (req, res) => {
			res.json({ status: 'ok', server: this.name })
		})

		// List available tools (MCP protocol)
		this.app.post('/tools/list', (req, res) => {
			const toolsList = Array.from(this.tools.values()).map((tool) => ({
				name: tool.name,
				description: tool.description,
				inputSchema: tool.inputSchema,
			}))
			
			res.json({
				tools: toolsList,
			})
		})

		// Execute a tool (MCP protocol)
		this.app.post('/tools/call', async (req, res) => {
			const { name, arguments: args } = req.body

			if (!this.tools.has(name)) {
				return res.status(404).json({
					error: `Tool '${name}' not found`,
				})
			}

			try {
				const tool = this.tools.get(name)
				const result = await tool.handler(args)
				
				res.json({
					content: [
						{
							type: 'text',
							text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
						},
					],
				})
			} catch (error) {
				res.status(500).json({
					error: error.message,
					stack: error.stack,
				})
			}
		})
	}

	/**
	 * Start the server
	 */
	async start() {
		return new Promise((resolve) => {
			this.server = this.app.listen(this.port, () => {
				console.log(`[${this.name}] MCP Server running on http://localhost:${this.port}`)
				resolve()
			})
		})
	}

	/**
	 * Stop the server
	 */
	async stop() {
		return new Promise((resolve) => {
			if (this.server) {
				this.server.close(() => {
					console.log(`[${this.name}] Server stopped`)
					resolve()
				})
			} else {
				resolve()
			}
		})
	}
}

