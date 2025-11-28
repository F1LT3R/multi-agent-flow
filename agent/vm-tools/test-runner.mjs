/**
 * Test Runner - VM Tools
 * These tools run INSIDE the Docker VM for maximum isolation.
 * All test execution happens within the container.
 */
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

// Project root inside the VM
const PROJECT_ROOT = '/project'

/**
 * Execute Node.js tests using built-in test runner
 */
export async function run_node_tests({ pattern = 'tests/**/*.test.mjs' }) {
	try {
		const { stdout, stderr } = await execAsync(
			`cd "${PROJECT_ROOT}" && node --test ${pattern}`,
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

/**
 * Execute Puppeteer browser tests
 */
export async function run_puppeteer({ testFile }) {
	try {
		const { stdout, stderr } = await execAsync(
			`cd "${PROJECT_ROOT}" && node ${testFile}`,
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

/**
 * Run npm install in the project directory
 */
export async function install_dependencies() {
	try {
		const { stdout, stderr } = await execAsync(
			`cd "${PROJECT_ROOT}" && npm install`,
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

/**
 * Parse and return structured test results
 */
export async function get_test_results({ output }) {
	// Simple parser for node test runner output
	const lines = output.split('\n')
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

/**
 * Tool definitions for AI model
 */
export const TOOL_DEFINITIONS = [
	{
		name: 'run_node_tests',
		description: 'Execute Node.js tests using built-in test runner (runs in VM)',
		inputSchema: {
			type: 'object',
			properties: {
				pattern: { type: 'string', description: 'Test file pattern (default: tests/**/*.test.mjs)', default: 'tests/**/*.test.mjs' },
			},
		},
	},
	{
		name: 'run_puppeteer',
		description: 'Execute Puppeteer browser tests (runs in VM)',
		inputSchema: {
			type: 'object',
			properties: {
				testFile: { type: 'string', description: 'Path to test file' },
			},
			required: ['testFile'],
		},
	},
	{
		name: 'install_dependencies',
		description: 'Run npm install in the project directory (runs in VM)',
		inputSchema: {
			type: 'object',
			properties: {},
		},
	},
	{
		name: 'get_test_results',
		description: 'Parse and return structured test results',
		inputSchema: {
			type: 'object',
			properties: {
				output: { type: 'string', description: 'Raw test output to parse' },
			},
			required: ['output'],
		},
	},
]

