/**
 * Test Runner - VM Tools
 * These tools run INSIDE the Docker VM for maximum isolation.
 * All test execution happens within the container.
 */
import { exec } from 'child_process'
import { promisify } from 'util'
import { validatePath } from './file-operations.mjs'

const execAsync = promisify(exec)

// Project root inside the VM
const PROJECT_ROOT = '/project'

/**
 * Find test files matching a pattern
 * Excludes .flow/ and node_modules/ directories
 */
async function findTestFiles(pattern) {
	try {
		const { stdout } = await execAsync(
			`cd "${PROJECT_ROOT}" && find . -type d \\( -name .flow -o -name node_modules \\) -prune -o -type f \\( -name "*.test.mjs" -o -name "*.test.js" \\) -print 2>/dev/null | head -20`,
			{ maxBuffer: 1024 * 1024 }
		)
		return stdout.trim().split('\n').filter(f => f.length > 0)
	} catch {
		return []
	}
}

/**
 * Check if a pattern tries to access protected directories
 */
function isProtectedPath(pattern) {
	const normalized = pattern.replace(/^\.\//, '')
	return normalized.startsWith('.flow/') || normalized.startsWith('.flow') ||
	       normalized.includes('/.flow/') || normalized.includes('/.flow') ||
	       normalized.startsWith('node_modules/') || normalized.includes('/node_modules/')
}

/**
 * Check if a glob pattern matches any files
 * Rejects patterns that try to access .flow/ or node_modules/
 */
async function patternMatchesFiles(pattern) {
	// Block patterns targeting protected directories
	if (isProtectedPath(pattern)) {
		return false
	}

	try {
		// Use ls with the pattern to check if files exist
		const { stdout } = await execAsync(
			`cd "${PROJECT_ROOT}" && ls ${pattern} 2>/dev/null | head -5`,
			{ maxBuffer: 1024 * 1024 }
		)
		return stdout.trim().length > 0
	} catch {
		return false
	}
}

/**
 * Execute Node.js tests using built-in test runner
 * Smart fallback: if pattern finds no files, auto-discovers tests
 */
export async function run_node_tests({ pattern, test_file } = {}) {
	try {
		let testTarget = pattern || test_file

		// Block access to protected directories
		if (testTarget && isProtectedPath(testTarget)) {
			return {
				success: false,
				stdout: '',
				stderr: `Access to protected directory not allowed: ${testTarget}`,
				error: `Cannot run tests from .flow/ or node_modules/ directories`,
			}
		}

		// If a pattern/file was provided, check if it exists
		if (testTarget) {
			const hasFiles = await patternMatchesFiles(testTarget)
			if (!hasFiles) {
				// Pattern provided but no files found - try fallback
				const allTests = await findTestFiles()
				if (allTests.length > 0) {
					console.error(`⚠️ Pattern "${testTarget}" found no files. Found ${allTests.length} test file(s) elsewhere:`)
					allTests.forEach(f => console.error(`   ${f}`))
					// Use the discovered files instead
					testTarget = allTests.join(' ')
				} else {
					return {
						success: false,
						stdout: '',
						stderr: `No test files found matching "${testTarget}" and no *.test.mjs files found in project.`,
						error: `Could not find test files. Looked for: ${testTarget}`,
					}
				}
			}
		} else {
			// No pattern provided - auto-discover
			const allTests = await findTestFiles()
			if (allTests.length === 0) {
				return {
					success: false,
					stdout: '',
					stderr: 'No test files found. Looking for *.test.mjs or *.test.js files.',
					error: 'No test files found in project.',
				}
			}
			console.error(`🔍 Auto-discovered ${allTests.length} test file(s):`)
			allTests.forEach(f => console.error(`   ${f}`))
			testTarget = allTests.join(' ')
		}

		const { stdout, stderr } = await execAsync(
			`cd "${PROJECT_ROOT}" && node --test ${testTarget}`,
			{
				maxBuffer: 10 * 1024 * 1024,
				env: { ...process.env, FORCE_COLOR: '1' }
			}
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
 * Puppeteer and Chromium are pre-installed in the VM
 */
export async function run_puppeteer({ testFile }) {
	try {
		// Validate path before use - blocks .flow/, absolute paths, and traversal
		await validatePath(testFile, false)

		// Run with NODE_PATH to find pre-installed puppeteer
		// PUPPETEER_EXECUTABLE_PATH is set in the Docker image to use system chromium
		const { stdout, stderr } = await execAsync(
			`cd "${PROJECT_ROOT}" && NODE_PATH=/workspace/agent/node_modules node ${testFile}`,
			{
				maxBuffer: 10 * 1024 * 1024,
				timeout: 300000, // 5 minutes for browser tests
			}
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
		description: 'Execute Node.js tests using built-in test runner (runs in VM). Auto-discovers test files if pattern not provided or pattern matches no files.',
		inputSchema: {
			type: 'object',
			properties: {
				pattern: { type: 'string', description: 'Optional glob pattern (e.g., "*.test.mjs" or "tests/**/*.test.mjs"). If omitted or no files match, auto-discovers *.test.mjs files.' },
				test_file: { type: 'string', description: 'Optional specific test file path (e.g., "calculator.test.mjs")' },
			},
		},
	},
	{
		name: 'run_puppeteer',
		description: 'Execute Puppeteer browser tests. Puppeteer and Chromium are pre-installed. Use: const puppeteer = require("puppeteer"); browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"] })',
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

