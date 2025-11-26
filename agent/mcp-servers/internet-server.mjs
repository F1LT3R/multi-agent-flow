import { BaseMCPServer } from './base-server.mjs'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

/**
 * Internet Resources MCP Server
 * Provides web fetching capabilities
 */
export class InternetServer extends BaseMCPServer {
	constructor(port) {
		super('InternetServer', port)
		this._registerTools()
	}

	_registerTools() {
		// wget - simple fetch
		this.registerTool(
			'wget',
			'Fetch content from a URL using wget',
			{
				type: 'object',
				properties: {
					url: { type: 'string', description: 'URL to fetch' },
					output: { type: 'string', description: 'Optional output file name' },
				},
				required: ['url'],
			},
			async (args) => {
				try {
					const outputFlag = args.output ? `-O ${args.output}` : '-O -'
					const { stdout, stderr } = await execAsync(
						`wget -q ${outputFlag} "${args.url}"`,
						{ maxBuffer: 10 * 1024 * 1024, timeout: 30000 }
					)
					
					return {
						success: true,
						content: stdout,
						stderr,
					}
				} catch (error) {
					return {
						success: false,
						error: error.message,
						stderr: error.stderr || '',
					}
				}
			}
		)

		// httpie - advanced HTTP client
		this.registerTool(
			'httpie',
			'Make HTTP requests with custom headers using httpie',
			{
				type: 'object',
				properties: {
					url: { type: 'string', description: 'URL to request' },
					method: { type: 'string', description: 'HTTP method (GET, POST, etc)', default: 'GET' },
					headers: { type: 'object', description: 'HTTP headers as key-value pairs' },
					body: { type: 'string', description: 'Request body (for POST/PUT)' },
				},
				required: ['url'],
			},
			async (args) => {
				try {
					const method = args.method || 'GET'
					let cmd = `curl -X ${method} "${args.url}"`
					
					// Add headers
					if (args.headers) {
						for (const [key, value] of Object.entries(args.headers)) {
							cmd += ` -H "${key}: ${value}"`
						}
					}
					
					// Add body
					if (args.body) {
						cmd += ` -d '${args.body}'`
					}
					
					const { stdout, stderr } = await execAsync(cmd, {
						maxBuffer: 10 * 1024 * 1024,
						timeout: 30000,
					})
					
					return {
						success: true,
						content: stdout,
						stderr,
					}
				} catch (error) {
					return {
						success: false,
						error: error.message,
						stderr: error.stderr || '',
					}
				}
			}
		)
	}
}

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
	const port = process.env.MCP_INTERNET_PORT || 3103
	
	const server = new InternetServer(port)
	await server.start()
	
	// Graceful shutdown
	process.on('SIGINT', async () => {
		await server.stop()
		process.exit(0)
	})
}

