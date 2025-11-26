import { BaseMCPServer } from './base-server.mjs'
import { exec } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import fs from 'fs/promises'

const execAsync = promisify(exec)

/**
 * Code Analysis MCP Server
 * Provides linting and style checking
 */
export class AnalysisServer extends BaseMCPServer {
	constructor(port, projectRoot) {
		super('AnalysisServer', port)
		this.projectRoot = path.resolve(projectRoot)
		this._registerTools()
	}

	_registerTools() {
		// Lint code
		this.registerTool(
			'lint_code',
			'Run ESLint on code files',
			{
				type: 'object',
				properties: {
					path: { type: 'string', description: 'Path to file or directory to lint', default: '.' },
				},
			},
			async (args) => {
				const targetPath = args.path || '.'
				
				try {
					// Try to use project's eslint if available
					const { stdout, stderr } = await execAsync(
						`cd "${this.projectRoot}" && npx eslint ${targetPath} --format json 2>&1 || true`,
						{ maxBuffer: 10 * 1024 * 1024 }
					)
					
					try {
						const results = JSON.parse(stdout)
						return {
							success: results.every((r) => r.errorCount === 0),
							results,
						}
					} catch {
						// If ESLint not configured, return simple analysis
						return {
							success: true,
							message: 'ESLint not configured. Install ESLint for detailed linting.',
							output: stdout + stderr,
						}
					}
				} catch (error) {
					return {
						success: false,
						error: error.message,
					}
				}
			}
		)

		// Check style
		this.registerTool(
			'check_style',
			'Check code style and formatting',
			{
				type: 'object',
				properties: {
					path: { type: 'string', description: 'Path to file or directory to check' },
				},
				required: ['path'],
			},
			async (args) => {
				try {
					const filePath = path.join(this.projectRoot, args.path)
					const content = await fs.readFile(filePath, 'utf-8')
					
					const issues = []
					
					// Basic style checks
					const lines = content.split('\n')
					
					// Check for spaces vs tabs
					const hasSpaces = lines.some((line) => line.startsWith('  '))
					const hasTabs = lines.some((line) => line.startsWith('\t'))
					
					if (hasSpaces && hasTabs) {
						issues.push('Mixed indentation (spaces and tabs)')
					}
					
					// Check for double quotes
					if (content.includes('"') && !content.includes("'")) {
						issues.push('Using double quotes instead of single quotes')
					}
					
					// Check for semicolons
					const hasUnnecessarySemicolons = lines.some((line) => {
						const trimmed = line.trim()
						return trimmed.endsWith(';') && !trimmed.startsWith('for') && !trimmed.startsWith('while')
					})
					
					if (hasUnnecessarySemicolons) {
						issues.push('Unnecessary semicolons found')
					}
					
					// Check for classes
					if (content.includes('class ')) {
						issues.push('Using classes instead of object composition')
					}
					
					return {
						success: issues.length === 0,
						issues,
						summary: issues.length === 0 ? 'Style guide compliant' : `${issues.length} style issues found`,
					}
				} catch (error) {
					return {
						success: false,
						error: error.message,
					}
				}
			}
		)
	}
}

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
	const port = process.env.MCP_ANALYSIS_PORT || 3102
	const projectRoot = process.env.PROJECT_ROOT || path.join(process.cwd(), 'project')
	
	const server = new AnalysisServer(port, projectRoot)
	await server.start()
	
	// Graceful shutdown
	process.on('SIGINT', async () => {
		await server.stop()
		process.exit(0)
	})
}

