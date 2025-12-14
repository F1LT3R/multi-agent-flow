/**
 * Code Analysis - VM Tools
 * These tools run INSIDE the Docker VM for maximum isolation.
 * Linting and style checking happens within the container.
 */
import { exec } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import fs from 'fs/promises'
import { validatePath } from './file-operations.mjs'

const execAsync = promisify(exec)

// Project root inside the VM
const PROJECT_ROOT = '/project'

/**
 * Run ESLint on code files
 */
export async function lint_code({ path: targetPath = '.' }) {
	try {
		// Validate path before use - blocks .flow/, absolute paths, and traversal
		await validatePath(targetPath, false)

		// Try to use project's eslint if available
		const { stdout, stderr } = await execAsync(
			`cd "${PROJECT_ROOT}" && npx eslint ${targetPath} --format json 2>&1 || true`,
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

/**
 * Check code formatting with prettier
 */
export async function check_style({ path: filePath }) {
	try {
		// Validate path before use - blocks .flow/, absolute paths, and traversal
		const resolvedPath = await validatePath(filePath, false)

		// Try to use project's prettier if available
		const prettier = await import('prettier')

		const content = await fs.readFile(resolvedPath, 'utf-8')

		// Look for prettier config
		const configPath = await prettier.resolveConfigFile(PROJECT_ROOT)

		if (!configPath) {
			return {
				success: true,
				message: 'Prettier not configured. Install prettier and add config for style checking.',
			}
		}

		const config = await prettier.resolveConfig(configPath)

		// Check if file should be formatted
		const fileInfo = await prettier.getFileInfo(resolvedPath, {
			ignorePath: path.join(PROJECT_ROOT, '.prettierignore'),
		})

		if (fileInfo.ignored) {
			return {
				success: true,
				message: 'File ignored by prettier',
			}
		}

		if (!fileInfo.inferredParser) {
			return {
				success: true,
				message: 'File type not supported by prettier',
			}
		}

		// Check if file is formatted
		const isFormatted = await prettier.check(content, {
			...config,
			filepath: resolvedPath,
		})

		if (isFormatted) {
			return {
				success: true,
				message: 'File is properly formatted',
			}
		} else {
			// Get formatted version to show diff info
			const formatted = await prettier.format(content, {
				...config,
				filepath: resolvedPath,
			})

			return {
				success: false,
				message: 'File needs formatting',
				details: `File has ${formatted.split('\n').length - content.split('\n').length} line difference(s)`,
			}
		}
	} catch (error) {
		return {
			success: true,
			message: `Style check skipped: ${error.message}`,
		}
	}
}

/**
 * Tool definitions for AI model
 */
export const TOOL_DEFINITIONS = [
	{
		name: 'lint_code',
		description: 'Run ESLint on code files (runs in VM)',
		inputSchema: {
			type: 'object',
			properties: {
				path: { type: 'string', description: 'Path to file or directory to lint', default: '.' },
			},
		},
	},
	{
		name: 'check_style',
		description: 'Check code formatting with prettier (uses project config, runs in VM)',
		inputSchema: {
			type: 'object',
			properties: {
				path: { type: 'string', description: 'Path to file to check' },
			},
			required: ['path'],
		},
	},
]

