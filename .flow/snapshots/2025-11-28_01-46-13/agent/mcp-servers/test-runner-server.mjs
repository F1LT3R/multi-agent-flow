import { BaseMCPServer } from './base-server.mjs'
import { exec } from 'child_process'
import { promisify } from 'util'
import path from 'path'

const execAsync = promisify(exec)

/**
 * Test Runner MCP Server
 * Executes tests and manages dependencies
 */
export class TestRunnerServer extends BaseMCPServer {
	constructor(port, projectRoot) {
		super('TestRunnerServer', port)
		this.projectRoot = path.resolve(projectRoot)
		this._registerTools()
	}

	_registerTools() {
		// Run Node.js tests
		this.registerTool(
			'run_node_tests',
			'Execute Node.js tests using built-in test runner',
			{
				type: 'object',
				properties: {
					pattern: { type: 'string', description: 'Test file pattern (default: tests/**/*.test.mjs)', default: 'tests/**/*.test.mjs' },
				},
			},
			async (args) => {
				try {
					const pattern = args.pattern || 'tests/**/*.test.mjs'
					const { stdout, stderr } = await execAsync(
						`cd "${this.projectRoot}" && node --test ${pattern}`,
						{ maxBuffer: 10 * 1024 * 1024 }
					)
					
					return {
						success: true,
						stdout,
						stderr,
					}
				} catch (error) {
					return {
						success: false,
						stdout: error.stdout || '',
						stderr: error.stderr || '',
						error: error.message,
					}
				}
			}
		)

		// Run Puppeteer tests
		this.registerTool(
			'run_puppeteer',
			'Execute Puppeteer browser tests',
			{
				type: 'object',
				properties: {
					testFile: { type: 'string', description: 'Path to test file' },
				},
				required: ['testFile'],
			},
			async (args) => {
				try {
					const { stdout, stderr } = await execAsync(
						`cd "${this.projectRoot}" && node ${args.testFile}`,
						{ maxBuffer: 10 * 1024 * 1024 }
					)
					
					return {
						success: true,
						stdout,
						stderr,
					}
				} catch (error) {
					return {
						success: false,
						stdout: error.stdout || '',
						stderr: error.stderr || '',
						error: error.message,
					}
				}
			}
		)

		// Install dependencies
		this.registerTool(
			'install_dependencies',
			'Run npm install in the project directory',
			{
				type: 'object',
				properties: {},
			},
			async () => {
				try {
					const { stdout, stderr } = await execAsync(
						`cd "${this.projectRoot}" && npm install`,
						{ maxBuffer: 10 * 1024 * 1024, timeout: 120000 }
					)
					
					return {
						success: true,
						stdout,
						stderr,
					}
				} catch (error) {
					return {
						success: false,
						stdout: error.stdout || '',
						stderr: error.stderr || '',
						error: error.message,
					}
				}
			}
		)

		// Get test results
		this.registerTool(
			'get_test_results',
			'Parse and return structured test results',
			{
				type: 'object',
				properties: {
					output: { type: 'string', description: 'Raw test output to parse' },
				},
				required: ['output'],
			},
			async (args) => {
				// Simple parser for node test runner output
				const lines = args.output.split('\n')
				const tests = []
				let passing = 0
				let failing = 0
				
				for (const line of lines) {
					if (line.includes('✔') || line.includes('ok')) {
						passing++
					} else if (line.includes('✖') || line.includes('not ok')) {
						failing++
					}
				}
				
				return {
					total: passing + failing,
					passing,
					failing,
					success: failing === 0,
				}
			}
		)
	}
}

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
	const port = process.env.MCP_TEST_RUNNER_PORT || 3101
	const projectRoot = process.env.PROJECT_ROOT || path.join(process.cwd(), 'project')
	
	const server = new TestRunnerServer(port, projectRoot)
	await server.start()
	
	// Graceful shutdown
	process.on('SIGINT', async () => {
		await server.stop()
		process.exit(0)
	})
}

