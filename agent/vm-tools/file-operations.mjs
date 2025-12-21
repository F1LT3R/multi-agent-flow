/**
 * File Operations - VM Tools
 * These tools run INSIDE the Docker VM for maximum isolation.
 * All paths are relative to /project (the mounted user project).
 *
 * Directory structure:
 * - Code files: written directly to /project (user's project root)
 * - Tests: written alongside code (e.g., /project/calculator.test.mjs)
 * - .flow/: protected (checkpoints, snapshots, traces, ratchet, prompts, config)
 *
 * Ratcheted tests:
 * - Tests from .flow/ratchet/tests/ are copied to project root as read-only (chmod 444)
 * - Agents CANNOT modify these files directly
 * - To update a ratcheted test, create a .new.test.mjs file instead
 */
import fs from 'fs/promises'
import path from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'
import { minimatch } from 'minimatch'

const execAsync = promisify(exec)

// Project root inside the VM
const PROJECT_ROOT = '/project'

/**
 * Check if a file is read-only (ratcheted test)
 */
async function isReadOnly(filePath) {
	try {
		const stats = await fs.stat(filePath)
		// Check if file is writable by owner (mode & 0o200)
		return (stats.mode & 0o200) === 0
	} catch (error) {
		return false // File doesn't exist, not read-only
	}
}

/**
 * Validate and resolve path with security checks
 * SECURITY: Prevents path traversal attacks, symlink escapes, and blocks protected directories
 * Exported for use by other VM tools (test-runner, analysis)
 */
export async function validatePath(relativePath, isWriteOperation = false) {
	// CRITICAL: Block absolute paths
	if (relativePath.startsWith('/')) {
		throw new Error(`Absolute paths not allowed: ${relativePath}`)
	}

	// CRITICAL: Block parent directory traversal
	if (relativePath.includes('..')) {
		throw new Error(`Parent directory access not allowed: ${relativePath}`)
	}

	// Resolve path relative to project root (logical path)
	const logicalPath = path.resolve(PROJECT_ROOT, relativePath)

	// CRITICAL: Resolve symlinks to get real path (closes symlink escape vector)
	// If a symlink points outside /project, realpath will reveal the true destination
	let resolved
	try {
		resolved = await fs.realpath(logicalPath)
	} catch (err) {
		// File doesn't exist yet - use logical path (safe for new files)
		// New files can't be symlinks, so logical path is safe
		resolved = logicalPath
	}

	// Ensure resolved path is within project root (catches symlink escapes)
	if (!resolved.startsWith(PROJECT_ROOT + path.sep) && resolved !== PROJECT_ROOT) {
		throw new Error(`Path escape attempt: ${relativePath}`)
	}

	// SECURITY: Block access to protected directories and files
	const normalizedPath = relativePath.replace(/^\.\//, '') // Remove leading ./

	// Block .flow/ directory (prompts, config, checkpoints, traces, ratchet, snapshots)
	if (normalizedPath.startsWith('.flow/') || normalizedPath === '.flow') {
		throw new Error(`Access to .flow/ directory is not allowed: ${relativePath}`)
	}

	// For write operations, check if file is read-only (ratcheted test)
	if (isWriteOperation) {
		const isRO = await isReadOnly(resolved)
		if (isRO) {
			// Check if it's a test file
			if (normalizedPath.includes('.test.')) {
				const baseName = path.basename(normalizedPath)
				const newFileName = baseName.replace('.test.', '.new.test.')
				throw new Error(
					`Cannot modify ratcheted test: ${relativePath}. ` +
					`This test is protected from modification. ` +
					`To propose changes, write to "${newFileName}" instead.`
				)
			}
			throw new Error(`Cannot modify read-only file: ${relativePath}`)
		}
	}

	return resolved
}

/**
 * Read contents of a file
 */
export async function read_file({ path: filePath }) {
	const resolvedPath = await validatePath(filePath, false)
	const content = await fs.readFile(resolvedPath, 'utf-8')
	return content
}

/**
 * Write contents to a file with optional prettier formatting
 * - Enforces ratchet protection for read-only test files
 * - Enforces file_constraints from agent config
 * - Auto-formats with prettier if installed in project
 * - Supports binary content via base64 encoding
 */
export async function write_file({ path: filePath, content, encoding = 'utf-8' }, fileConstraints = null) {
	// Check file constraints BEFORE path validation
	if (fileConstraints) {
		const { write_patterns, exclusions } = fileConstraints

		// If write_patterns is empty, agent is read-only
		if (write_patterns && write_patterns.length === 0) {
			throw new Error(`Agent is read-only and cannot write files`)
		}

		// Check if file matches allowed patterns
		if (write_patterns && write_patterns.length > 0) {
			const matchesInclude = write_patterns.some(p => minimatch(filePath, p))
			if (!matchesInclude) {
				throw new Error(`Agent cannot write "${filePath}" - allowed patterns: ${write_patterns.join(', ')}`)
			}
		}

		// Check exclusions with custom messages
		if (exclusions && exclusions.length > 0) {
			for (const exclusion of exclusions) {
				const matchesExclude = exclusion.patterns.some(p => minimatch(filePath, p))
				if (matchesExclude) {
					throw new Error(exclusion.message)
				}
			}
		}
	}

	const resolvedPath = await validatePath(filePath, true)
	await fs.mkdir(path.dirname(resolvedPath), { recursive: true })

	// Handle binary content (base64-encoded)
	if (encoding === 'base64') {
		const buffer = Buffer.from(content, 'base64')
		await fs.writeFile(resolvedPath, buffer)
		return `File written: ${filePath} (${buffer.length} bytes)`
	}

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
	const resolvedPath = await validatePath(dirPath, false)
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
	const resolvedPath = await validatePath(filePath, true)
	await fs.unlink(resolvedPath)
	return `File deleted: ${filePath}`
}

/**
 * Move or rename a file
 */
export async function move_file({ from, to }) {
	const fromPath = await validatePath(from, false)
	const toPath = await validatePath(to, true)
	await fs.mkdir(path.dirname(toPath), { recursive: true })
	await fs.rename(fromPath, toPath)
	return `File moved: ${from} -> ${to}`
}

/**
 * Search for pattern in files
 */
export async function grep({ pattern, path: searchPath = '.' }) {
	const resolvedPath = await validatePath(searchPath, false)
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
		description: 'Read contents of a file. Paths are relative to project root. Can read code, test files, and other project files. CANNOT read: .flow/ directory.',
		inputSchema: {
			type: 'object',
			properties: {
				path: { type: 'string', description: 'Relative path to file, e.g., "calculator.js", "lib/utils.js", "calculator.test.mjs"' },
			},
			required: ['path'],
		},
	},
	{
		name: 'write_file',
		description: 'Write contents to a file. Supports text (UTF-8) and binary (base64) content. Tests and code are written directly to project root. PROTECTED: Ratcheted test files (read-only) cannot be modified - create a .new.test.mjs file instead. CANNOT write to: .flow/ directory. Auto-formats text files with prettier if installed.',
		inputSchema: {
			type: 'object',
			properties: {
				path: { type: 'string', description: 'Relative path for the file, e.g., "calculator.js", "image.png"' },
				content: { type: 'string', description: 'Content to write (text or base64-encoded binary)' },
				encoding: { type: 'string', description: 'Encoding: "utf-8" (default) or "base64" for binary files', default: 'utf-8' },
			},
			required: ['path', 'content'],
		},
	},
	{
		name: 'list_directory',
		description: 'List contents of a directory to discover project structure',
		inputSchema: {
			type: 'object',
			properties: {
				path: { type: 'string', description: 'Path to directory: "." for project root, "dirname" for subdirectory', default: '.' },
			},
		},
	},
	{
		name: 'delete_file',
		description: 'Delete a file. Cannot delete read-only (ratcheted) files.',
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
		description: 'Move or rename a file. Cannot move read-only (ratcheted) files.',
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
