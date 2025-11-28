/**
 * Code Analysis - VM Tools
 * These tools run INSIDE the Docker VM for maximum isolation.
 * Linting and style checking happens within the container.
 */
import { exec } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import fs from 'fs/promises'

const execAsync = promisify(exec)

// Project root inside the VM
const PROJECT_ROOT = '/project'

/**
 * Run ESLint on code files
 */
export async function lint_code({ path: targetPath = '.' }) {
	try {
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
 * Check code style and formatting
 */
export async function check_style({ path: filePath }) {
	try {
		const fullPath = path.join(PROJECT_ROOT, filePath)
		const content = await fs.readFile(fullPath, 'utf-8')

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
		description: 'Check code style and formatting (runs in VM)',
		inputSchema: {
			type: 'object',
			properties: {
				path: { type: 'string', description: 'Path to file to check' },
			},
			required: ['path'],
		},
	},
]

