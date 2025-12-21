/**
 * Prompt-Based Tool Parser
 * Parses structured commands from model text output for models without native tool calling
 */

import { callTool } from './index.mjs'

/**
 * Parse structured tool commands from model output
 * Supports triple-backtick format: ```TOOL_NAME\nkey: value\n```
 * 
 * @param {string} content - Model response content
 * @returns {Array} Parsed commands
 */
export function parseToolCommands(content) {
	const commands = []
	
	// Match triple-backtick blocks with tool names
	// Format: ```TOOL_NAME\nkey: value\nkey: value\n```
	const blockRegex = /```([A-Z_]+)\n([\s\S]*?)```/g
	
	let match
	while ((match = blockRegex.exec(content)) !== null) {
		const toolName = match[1]
		const blockContent = match[2].trim()
		
		// Parse the block content into arguments
		const args = parseBlockContent(blockContent, toolName)
		
		// Convert tool name from UPPERCASE to lowercase
		const normalizedToolName = toolName.toLowerCase()
		
		commands.push({
			name: normalizedToolName,
			args,
			raw: match[0]
		})
	}
	
	return commands
}

/**
 * Parse block content into tool arguments
 * Handles both key:value format and special cases like content blocks
 * 
 * @param {string} content - Block content
 * @param {string} toolName - Tool name for context
 * @returns {Object} Parsed arguments
 */
function parseBlockContent(content, toolName) {
	const args = {}
	const lines = content.split('\n')
	
	let currentKey = null
	let currentValue = []
	
	for (const line of lines) {
		// Check if line is a key:value pair
		const keyValueMatch = line.match(/^(\w+):\s*(.*)$/)
		
		if (keyValueMatch) {
			// Save previous key if exists
			if (currentKey) {
				args[currentKey] = currentValue.join('\n').trim()
			}
			
			// Start new key
			currentKey = keyValueMatch[1]
			const value = keyValueMatch[2]
			
			if (value) {
				currentValue = [value]
			} else {
				currentValue = []
			}
		} else if (currentKey) {
			// Continuation of current value
			currentValue.push(line)
		}
	}
	
	// Save last key
	if (currentKey) {
		args[currentKey] = currentValue.join('\n').trim()
	}
	
	return args
}

/**
 * Execute parsed commands through VM tools
 * 
 * @param {Array} commands - Parsed commands
 * @param {Object} agentConfig - Agent configuration (includes file_constraints)
 * @returns {Promise<Array>} Execution results
 */
export async function executeToolCommands(commands, agentConfig) {
	const results = []
	
	for (const cmd of commands) {
		try {
			const result = await callTool(cmd.name, cmd.args, agentConfig)
			results.push({
				command: cmd.name,
				success: true,
				result,
				args: cmd.args
			})
		} catch (error) {
			results.push({
				command: cmd.name,
				success: false,
				error: error.message,
				args: cmd.args
			})
		}
	}
	
	return results
}

/**
 * Format command results as user message
 * 
 * @param {Array} results - Execution results
 * @returns {string} Formatted message
 */
export function formatToolResults(results) {
	let message = '\n## Tool Execution Results\n\n'
	
	for (const result of results) {
		if (result.success) {
			message += `✓ **${result.command}** succeeded\n`
			
			// Format result based on type
			if (typeof result.result === 'string') {
				// String results (like file contents)
				if (result.result.length > 500) {
					message += `\`\`\`\n${result.result.substring(0, 500)}...\n[truncated]\n\`\`\`\n\n`
				} else {
					message += `\`\`\`\n${result.result}\n\`\`\`\n\n`
				}
			} else if (Array.isArray(result.result)) {
				// Array results (like directory listings)
				message += `\`\`\`\n${result.result.join('\n')}\n\`\`\`\n\n`
			} else if (typeof result.result === 'object') {
				// Object results (like test results)
				message += '```json\n'
				message += JSON.stringify(result.result, null, 2)
				message += '\n```\n\n'
			} else {
				message += `Result: ${result.result}\n\n`
			}
		} else {
			message += `✗ **${result.command}** failed: ${result.error}\n\n`
		}
	}
	
	return message
}

