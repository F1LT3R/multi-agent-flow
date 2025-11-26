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
	constructor(port, projectRoot) {
		super('FileOpsServer', port)
		this.projectRoot = path.resolve(projectRoot)
		this._registerTools()
	}

	/**
	 * Validate and resolve path within project root
	 */
	_validatePath(relativePath) {
		const resolved = path.resolve(this.projectRoot, relativePath)
		
		if (!resolved.startsWith(this.projectRoot)) {
			throw new Error(`Path escape attempt: ${relativePath}`)
		}
		
		return resolved
	}

	_registerTools() {
		// Read file
		this.registerTool(
			'read_file',
			'Read contents of a file',
			{
				type: 'object',
				properties: {
					path: { type: 'string', description: 'Path to file relative to project root' },
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
			'Write contents to a file',
			{
				type: 'object',
				properties: {
					path: { type: 'string', description: 'Path to file relative to project root' },
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
			'List contents of a directory',
			{
				type: 'object',
				properties: {
					path: { type: 'string', description: 'Path to directory relative to project root', default: '.' },
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
					path: { type: 'string', description: 'Path to file relative to project root' },
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
					from: { type: 'string', description: 'Source path relative to project root' },
					to: { type: 'string', description: 'Destination path relative to project root' },
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

