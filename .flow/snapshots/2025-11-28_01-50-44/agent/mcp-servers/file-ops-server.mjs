import { BaseMCPServer } from './base-server.mjs'
import fs from 'fs/promises'
import path from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

/**
 * File Operations MCP Server
 * Provides file system operations with chroot to ./project
 */
export class FileOpsServer extends BaseMCPServer {
	constructor(port, projectRoot, options = {}) {
		super('FileOpsServer', port)
		this.projectRoot = path.resolve(projectRoot)
		this.workspaceRoot = options.workspaceRoot ? path.resolve(options.workspaceRoot) : path.dirname(this.projectRoot)
		this._registerTools()
	}

	/**
	 * Validate and resolve path with multi-directory access
	 * SECURITY: Prevents path traversal attacks while blocking protected directories
	 *
	 * New structure (projectRoot = workspace root):
	 * - ALLOWED: ./stories/, ./tests/, ./*.js (root code files), ./src/
	 * - BLOCKED: ./.flow/, ./flow.config.mjs, ./prompts/, ../ (parent access)
	 */
	_validatePath(relativePath) {
		// CRITICAL: Block absolute paths
		if (relativePath.startsWith('/')) {
			throw new Error(`Absolute paths not allowed: ${relativePath}`)
		}

		// CRITICAL: Block parent directory traversal
		if (relativePath.includes('..')) {
			throw new Error(`Parent directory access not allowed: ${relativePath}`)
		}

		// Resolve path (relative to workspace root = projectRoot)
		const resolved = path.resolve(this.projectRoot, relativePath)

		// Ensure resolved path is within project root
		if (!resolved.startsWith(this.projectRoot + path.sep) && resolved !== this.projectRoot) {
			throw new Error(`Path escape attempt: ${relativePath}`)
		}

		// SECURITY: Block writes to protected directories and files
		const normalizedPath = relativePath.replace(/^\.\//, '') // Remove leading ./

		// Block .flow/ directory
		if (normalizedPath.startsWith('.flow/') || normalizedPath === '.flow') {
			throw new Error(`Access to .flow/ directory is not allowed: ${relativePath}`)
		}

		// Block flow.config.mjs
		if (normalizedPath === 'flow.config.mjs') {
			throw new Error(`Modifying flow.config.mjs is not allowed`)
		}

		// Block prompts/ directory writes (agents should not modify their own prompts)
		if (normalizedPath.startsWith('prompts/') || normalizedPath === 'prompts') {
			throw new Error(`Modifying prompts/ directory is not allowed: ${relativePath}`)
		}

		// Allow: stories/, tests/, root code files
		return resolved
	}

	_registerTools() {
	// Read file
	this.registerTool(
		'read_file',
		'Read contents of a file. Paths are relative to /project root. Access code, stories, tests, prompts.',
		{
			type: 'object',
			properties: {
				path: { type: 'string', description: 'Relative path: "./file.js", "./stories/doc.md", "./tests/test.js", "./prompts/prompt.md"' },
			},
			required: ['path'],
		},
		async (args) => {
			const filePath = this._validatePath(args.path)
			const content = await fs.readFile(filePath, 'utf-8')
			return content
		}
	)

	// Write file
	this.registerTool(
		'write_file',
		'Write contents to a file. Paths relative to /project root. Can write to: code files, stories, tests. CANNOT write to: .flow/, flow.config.mjs, prompts/',
		{
			type: 'object',
			properties: {
				path: { type: 'string', description: 'Relative path: "./file.js", "./stories/doc.md", "./tests/test.js"' },
				content: { type: 'string', description: 'Content to write' },
			},
			required: ['path', 'content'],
		},
		async (args) => {
			const filePath = this._validatePath(args.path)
			await fs.mkdir(path.dirname(filePath), { recursive: true })
			await fs.writeFile(filePath, args.content, 'utf-8')
			return `File written: ${args.path}`
		}
	)

		// List directory
		this.registerTool(
			'list_directory',
			'List contents of a directory. Supports project (.) and workspace dirs (../plans, ../tests)',
			{
				type: 'object',
				properties: {
					path: { type: 'string', description: 'Path to directory: "." for project root, "../plans" for plans, "../tests" for tests', default: '.' },
				},
			},
			async (args) => {
				const dirPath = this._validatePath(args.path || '.')
				const entries = await fs.readdir(dirPath, { withFileTypes: true })

				const items = entries.map((entry) => ({
					name: entry.name,
					type: entry.isDirectory() ? 'directory' : 'file',
				}))

				return JSON.stringify(items, null, 2)
			}
		)

		// Delete file
		this.registerTool(
			'delete_file',
			'Delete a file',
			{
				type: 'object',
				properties: {
					path: { type: 'string', description: 'Path to file: "./file.js" for project, "../plans/file.md" for plans, "../tests/file.js" for tests' },
				},
				required: ['path'],
			},
			async (args) => {
				const filePath = this._validatePath(args.path)
				await fs.unlink(filePath)
				return `File deleted: ${args.path}`
			}
		)

		// Move file
		this.registerTool(
			'move_file',
			'Move or rename a file',
			{
				type: 'object',
				properties: {
					from: { type: 'string', description: 'Source path' },
					to: { type: 'string', description: 'Destination path' },
				},
				required: ['from', 'to'],
			},
			async (args) => {
				const fromPath = this._validatePath(args.from)
				const toPath = this._validatePath(args.to)
				await fs.mkdir(path.dirname(toPath), { recursive: true })
				await fs.rename(fromPath, toPath)
				return `File moved: ${args.from} -> ${args.to}`
			}
		)

		// Grep
		this.registerTool(
			'grep',
			'Search for pattern in files',
			{
				type: 'object',
				properties: {
					pattern: { type: 'string', description: 'Pattern to search for' },
					path: { type: 'string', description: 'Path to search in (default: current dir)', default: '.' },
				},
				required: ['pattern'],
			},
			async (args) => {
				const searchPath = this._validatePath(args.path || '.')
				try {
					const { stdout } = await execAsync(
						`grep -r "${args.pattern}" "${searchPath}" 2>/dev/null || true`
					)
					return stdout || 'No matches found'
				} catch (error) {
					return `Error searching: ${error.message}`
				}
			}
		)
	}
}

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
	const port = process.env.MCP_FILE_OPS_PORT || 3100
	const projectRoot = process.env.PROJECT_ROOT || path.join(process.cwd(), 'project')

	const server = new FileOpsServer(port, projectRoot)
	await server.start()

	// Graceful shutdown
	process.on('SIGINT', async () => {
		await server.stop()
		process.exit(0)
	})
}

