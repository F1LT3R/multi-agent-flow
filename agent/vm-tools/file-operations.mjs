/**
 * File Operations - VM Tools
 * These tools run INSIDE the Docker VM for maximum isolation.
 * All paths are relative to /project (the mounted user project).
 */
import fs from 'fs/promises'
import path from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

// Project root inside the VM
const PROJECT_ROOT = '/project'

/**
 * Validate and resolve path with security checks
 * SECURITY: Prevents path traversal attacks and blocks protected directories
 */
function validatePath(relativePath) {
	// CRITICAL: Block absolute paths
	if (relativePath.startsWith('/')) {
		throw new Error(`Absolute paths not allowed: ${relativePath}`)
	}

	// CRITICAL: Block parent directory traversal
	if (relativePath.includes('..')) {
		throw new Error(`Parent directory access not allowed: ${relativePath}`)
	}

	// Resolve path relative to project root
	const resolved = path.resolve(PROJECT_ROOT, relativePath)

	// Ensure resolved path is within project root
	if (!resolved.startsWith(PROJECT_ROOT + path.sep) && resolved !== PROJECT_ROOT) {
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

	return resolved
}

/**
 * Read contents of a file
 */
export async function read_file({ path: filePath }) {
	const resolvedPath = validatePath(filePath)
	const content = await fs.readFile(resolvedPath, 'utf-8')
	return content
}

/**
 * Write contents to a file with optional prettier formatting
 */
export async function write_file({ path: filePath, content }) {
	const resolvedPath = validatePath(filePath)
	await fs.mkdir(path.dirname(resolvedPath), { recursive: true })

	// Try to format with prettier if available in project
	let finalContent = content
	try {
		// Dynamically import prettier from project's node_modules
		const prettier = await import('prettier')

		// Look for prettier config in project
		const configPath = await prettier.resolveConfigFile(PROJECT_ROOT)

		// Only format if project has prettier config
		if (configPath) {
			const config = await prettier.resolveConfig(configPath)

			// Check if file should be formatted
			const fileInfo = await prettier.getFileInfo(resolvedPath, {
				ignorePath: path.join(PROJECT_ROOT, '.prettierignore'),
			})

			if (!fileInfo.ignored && fileInfo.inferredParser) {
				finalContent = await prettier.format(content, {
					...config,
					filepath: resolvedPath,
				})
			}
		}
	} catch (error) {
		// Prettier not installed or config not found - skip formatting silently
		// This is expected and fine - formatting is completely optional
	}

	await fs.writeFile(resolvedPath, finalContent, 'utf-8')
	return `File written: ${filePath}`
}

/**
 * List contents of a directory
 */
export async function list_directory({ path: dirPath = '.' }) {
	const resolvedPath = validatePath(dirPath)
	const entries = await fs.readdir(resolvedPath, { withFileTypes: true })

	const items = entries.map((entry) => ({
		name: entry.name,
		type: entry.isDirectory() ? 'directory' : 'file',
	}))

	return JSON.stringify(items, null, 2)
}

/**
 * Delete a file
 */
export async function delete_file({ path: filePath }) {
	const resolvedPath = validatePath(filePath)
	await fs.unlink(resolvedPath)
	return `File deleted: ${filePath}`
}

/**
 * Move or rename a file
 */
export async function move_file({ from, to }) {
	const fromPath = validatePath(from)
	const toPath = validatePath(to)
	await fs.mkdir(path.dirname(toPath), { recursive: true })
	await fs.rename(fromPath, toPath)
	return `File moved: ${from} -> ${to}`
}

/**
 * Search for pattern in files
 */
export async function grep({ pattern, path: searchPath = '.' }) {
	const resolvedPath = validatePath(searchPath)
	try {
		const { stdout } = await execAsync(
			`grep -r "${pattern}" "${resolvedPath}" 2>/dev/null || true`
		)
		return stdout || 'No matches found'
	} catch (error) {
		return `Error searching: ${error.message}`
	}
}

/**
 * Tool definitions for AI model
 */
export const TOOL_DEFINITIONS = [
	{
		name: 'read_file',
		description: 'Read contents of a file. Paths are relative to /project root. Access code, stories, tests, prompts.',
		inputSchema: {
			type: 'object',
			properties: {
				path: { type: 'string', description: 'Relative path: "./file.js", "./stories/doc.md", "./tests/test.js", "./prompts/prompt.md"' },
			},
			required: ['path'],
		},
	},
	{
		name: 'write_file',
		description: 'Write contents to a file. Automatically formats with prettier if installed in project. Paths relative to /project root. Can write to: code files, stories, tests. CANNOT write to: .flow/, flow.config.mjs, prompts/',
		inputSchema: {
			type: 'object',
			properties: {
				path: { type: 'string', description: 'Relative path: "./file.js", "./stories/doc.md", "./tests/test.js"' },
				content: { type: 'string', description: 'Content to write' },
			},
			required: ['path', 'content'],
		},
	},
	{
		name: 'list_directory',
		description: 'List contents of a directory',
		inputSchema: {
			type: 'object',
			properties: {
				path: { type: 'string', description: 'Path to directory: "." for project root', default: '.' },
			},
		},
	},
	{
		name: 'delete_file',
		description: 'Delete a file',
		inputSchema: {
			type: 'object',
			properties: {
				path: { type: 'string', description: 'Path to file to delete' },
			},
			required: ['path'],
		},
	},
	{
		name: 'move_file',
		description: 'Move or rename a file',
		inputSchema: {
			type: 'object',
			properties: {
				from: { type: 'string', description: 'Source path' },
				to: { type: 'string', description: 'Destination path' },
			},
			required: ['from', 'to'],
		},
	},
	{
		name: 'grep',
		description: 'Search for pattern in files',
		inputSchema: {
			type: 'object',
			properties: {
				pattern: { type: 'string', description: 'Pattern to search for' },
				path: { type: 'string', description: 'Path to search in (default: current dir)', default: '.' },
			},
			required: ['pattern'],
		},
	},
]

