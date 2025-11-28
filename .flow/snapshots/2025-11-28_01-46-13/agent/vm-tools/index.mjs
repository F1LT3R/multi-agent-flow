/**
 * VM Tools Registry
 * Central registry for all tools that run inside the Docker VM.
 * These are imported directly by the VM script - no HTTP, no IPC.
 */

// Import all tool modules
import * as fileOps from './file-operations.mjs'
import * as testRunner from './test-runner.mjs'
import * as analysis from './analysis.mjs'

/**
 * All available tools mapped by name
 */
export const TOOLS = {
	// File operations
	read_file: fileOps.read_file,
	write_file: fileOps.write_file,
	list_directory: fileOps.list_directory,
	delete_file: fileOps.delete_file,
	move_file: fileOps.move_file,
	grep: fileOps.grep,

	// Test runner
	run_node_tests: testRunner.run_node_tests,
	run_puppeteer: testRunner.run_puppeteer,
	install_dependencies: testRunner.install_dependencies,
	get_test_results: testRunner.get_test_results,

	// Analysis
	lint_code: analysis.lint_code,
	check_style: analysis.check_style,
}

/**
 * All tool definitions for AI model
 */
export const TOOL_DEFINITIONS = [
	...fileOps.TOOL_DEFINITIONS,
	...testRunner.TOOL_DEFINITIONS,
	...analysis.TOOL_DEFINITIONS,
]

/**
 * Call a tool by name
 * @param {string} name - Tool name
 * @param {object} args - Tool arguments
 * @returns {Promise<any>} Tool result
 */
export async function callTool(name, args) {
	const tool = TOOLS[name]
	if (!tool) {
		throw new Error(`Unknown tool: ${name}`)
	}
	return await tool(args)
}

/**
 * Get tool definitions filtered by allowed list
 * @param {string[]} allowedTools - List of allowed tool names (or '*' for all)
 * @returns {object[]} Filtered tool definitions
 */
export function getToolDefinitions(allowedTools) {
	if (!allowedTools || allowedTools.includes('*')) {
		return TOOL_DEFINITIONS
	}

	return TOOL_DEFINITIONS.filter((tool) => allowedTools.includes(tool.name))
}

/**
 * Convert tool definitions to OpenAI format
 * @param {object[]} definitions - Tool definitions
 * @returns {object[]} OpenAI-formatted tools
 */
export function toOpenAIFormat(definitions) {
	return definitions.map((tool) => ({
		type: 'function',
		function: {
			name: tool.name,
			description: tool.description,
			parameters: tool.inputSchema,
		},
	}))
}

